using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class SeedStall : MonoBehaviour
{
    private bool Interaction = false;
    public GameObject seedUI;
    public Text pressOpen;
    void Start()
    {
        
    }
    void Update()
    {
        if (Interaction == true)
        {
            pressOpen.enabled = true;    
            if (Input.GetKey(KeyCode.E))
            {
                seedUI.SetActive(true);
            }   
        }
        else
        {
            pressOpen.enabled = false;
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
           seedUI.SetActive(false);
           
       }  
    }

    //Buttons
    public void CloseButton()
    {
        seedUI.SetActive(false);
    }
    public void Seed0()
    {
        Debug.Log("Peguei a sacola");
    }
    public void Seed1()
    {
        Debug.Log("Peguei a maçã");
    }
    public void Seed2()
    {
        Debug.Log("Peguei a chave");
    }
}
