using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class ToolGrab : MonoBehaviour
{
    private bool Interaction;
    public GameObject Player;
    public GameObject shovelSprite;
    public GameObject spawnedTool;
    public GameObject position;
    public Text pressPick;
    
    void Start()
    {
        
    }

    
    void Update()
    {
        if (Interaction == true)
        {
            pressPick.enabled = true;

            if (Input.GetKeyDown(KeyCode.E))
            {
                GameObject spawnedTool = Instantiate(shovelSprite, position.transform.position, Quaternion.identity) as GameObject;
                spawnedTool.transform.SetParent(Player.gameObject.transform);
                Player.gameObject.GetComponent<EventsManager>().holdingItem = HoldingItem.TOOL;

                /*if (spawnedTool != null)
                {
                    Destroy(spawnedTool);
                }*/
            }
        }
        else
        {
            pressPick.enabled = false;
        }
    }

    private void OnTriggerEnter2D(Collider2D other)
    {
       if (other.tag == "Player")
       {
           Interaction = true;
           
       }
        
    }
    private void OnTriggerExit2D(Collider2D other)
    {
       if (other.tag == "Player")
       {
           Interaction = false;
       }  
    }
}
