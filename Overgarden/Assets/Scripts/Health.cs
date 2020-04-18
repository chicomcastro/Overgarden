using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class Health : MonoBehaviour
{   
    public GameObject plant;
    public GameObject player;
    int aux = 0;
    int health;
    Vector3 diff;
    // Start is called before the first frame update
    void Start()
    {
        health = 100;
    }

    // Update is called once per frame
    void Update()
    {   
        gameObject.GetComponent<Text>().text = health.ToString();
        if(aux%10 == 0)
        {
            health--;
        }

        aux++;
        if(aux == 1000)
        {
            aux = 0;
        }

        if(health == 0)
        {
            Destroy(plant);
        }
        diff = plant.transform.position - player.transform.position;

        waterThePlants();
    }

    public void waterThePlants()
    {
        if(diff.magnitude < 1 && Input.GetKey(KeyCode.F))
        {
            health = 100;
            gameObject.GetComponent<Text>().text = health.ToString();
        }
    }
}
