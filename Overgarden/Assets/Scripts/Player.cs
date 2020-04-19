using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class Player : MonoBehaviour
{
    public float maxStamina = 100f;
    public float currentStamina;
    public StaminaBar staminaBar;
    Vector2 direction;
    private float speed;
    public float runSpeed;
    public float normalSpeed;
    private float regen;
    public float walkRegen;
    public float idleRegen;
    public Text pressE;
    
    public Transform player;
    public GameObject plant;
    public GameObject onHand;
    public Rigidbody2D rigidbody;
    public Animator animator;

    //public bool pickCondition;
    
    public bool IsMoving
    {
        get
        {
            return direction.x != 0 || direction.y !=0;
        }
    }

    public bool pickUpAllowed = false;
    
    // Start is called before the first frame update
    void Start()
    {
        currentStamina = maxStamina;
        staminaBar.SetMaxStamina(maxStamina);
        rigidbody = GetComponent<Rigidbody2D>();
        animator = GetComponent<Animator>();
        
        

    }

    // Update is called once per frame
    void Update()
    {
        rigidbody.velocity = direction.normalized * speed;
        GetInput();

        if (IsMoving)
        {
            ActivateLayer("Walk Layer");
            animator.SetFloat("x", direction.x);
            animator.SetFloat("y", direction.y);
            regen = walkRegen;    
        }
        else if (Input.GetKey(KeyCode.E))
        {
            ActivateLayer("Hold Layer");
        }
        else
        {
            ActivateLayer("Idle Layer");
            regen = idleRegen;
        }


        if (currentStamina > maxStamina)
        {
            currentStamina = maxStamina;
        }
        if (currentStamina < 0)
        {
            currentStamina = 0;
        }

        PickUp();

        

    }
    
    public void GetInput()
    {
        direction = Vector2.zero;

        if (Input.GetKey(KeyCode.W))
        {
            direction += Vector2.up;
        }
        if (Input.GetKey(KeyCode.S))
        {
            direction += Vector2.down;
        }
        if (Input.GetKey(KeyCode.A))
        {
            direction += Vector2.left;
        }
        if (Input.GetKey(KeyCode.D))
        {
            direction += Vector2.right;
        }


        if (Input.GetKey(KeyCode.LeftShift) && IsMoving)
        {
            speed = runSpeed;
            currentStamina -= 0.8f;
            staminaBar.SetStamina(currentStamina);

            if (currentStamina <= 0)
            {
                speed = normalSpeed;
            }
        }
        else
        {
            speed = normalSpeed;
            currentStamina += regen * Time.deltaTime;
            staminaBar.SetStamina(currentStamina);
        }
    }

    public void ActivateLayer(string layerName)
    {
        for(int i=0; i < animator.layerCount; i++)
        {
            animator.SetLayerWeight(i, 0);
        }

        animator.SetLayerWeight(animator.GetLayerIndex(layerName),1);
    }

    private void OnTriggerEnter2D(Collider2D other)
    {
       if (other.tag == "Game Plant")
       {
           pickUpAllowed = true;
       }
        
    }
    private void OnTriggerExit2D(Collider2D other)
    {
       if (other.tag == "Game Plant")
       {
           pickUpAllowed = false;
       }
        
    }

    private void PickUp()
    {
        if (pickUpAllowed == true)
        {
            pressE.enabled = true;

            if (Input.GetKeyDown(KeyCode.E))
            {
                plant.transform.SetParent(this.gameObject.transform);
                plant.transform.position = onHand.transform.position; 
                pressE.enabled = false;
                     
            }
            if (Input.GetKey(KeyCode.Q))
            {
                plant.transform.SetParent(null);
            }     
        }
        else
        {
            pressE.enabled = false;
        }
        
    }

   

}
